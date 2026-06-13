// Copyright Hollow Block. All Rights Reserved.

#include "Interaction/HLDoor.h"
#include "Components/StaticMeshComponent.h"
#include "Player/HLCharacter.h"

AHLDoor::AHLDoor()
{
	PrimaryActorTick.bCanEverTick = false;

	Hinge = CreateDefaultSubobject<USceneComponent>(TEXT("Hinge"));
	RootComponent = Hinge;

	DoorMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("DoorMesh"));
	DoorMesh->SetupAttachment(Hinge);
}

bool AHLDoor::CanInteract_Implementation(AActor* Interactor) const
{
	// Always interactable: an unmet lock still produces a (failed) rattle.
	return true;
}

void AHLDoor::Interact_Implementation(AActor* Interactor)
{
	if (bLocked)
	{
		const AHLCharacter* Char = Cast<AHLCharacter>(Interactor);
		const bool bHasKey = Char && !RequiredKeyTag.IsNone() && Char->HasKey(RequiredKeyTag);
		if (bHasKey)
		{
			bLocked = false;
		}
		else
		{
			OnRattleLocked();
			return;
		}
	}

	bIsOpen = !bIsOpen;
	OnSwing(bIsOpen);

	if (bIsOpen)
	{
		OnDoorOpened.Broadcast(this);
	}
}

FText AHLDoor::GetInteractText_Implementation() const
{
	if (bLocked)
	{
		return FText::FromString(TEXT("Locked"));
	}
	return bIsOpen
		? FText::FromString(TEXT("Close door"))
		: FText::FromString(TEXT("Open door"));
}
