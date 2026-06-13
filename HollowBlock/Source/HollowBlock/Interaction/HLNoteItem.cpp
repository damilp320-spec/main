// Copyright Hollow Block. All Rights Reserved.

#include "Interaction/HLNoteItem.h"
#include "Components/StaticMeshComponent.h"
#include "Core/HLTensionDirector.h"

AHLNoteItem::AHLNoteItem()
{
	PrimaryActorTick.bCanEverTick = false;

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
}

void AHLNoteItem::Interact_Implementation(AActor* Interactor)
{
	OnNoteRead.Broadcast(Title, Body);

	if (!bRead)
	{
		bRead = true;
		if (UHLTensionDirector* Director = UHLTensionDirector::Get(this))
		{
			Director->AddTension(TensionOnRead);
		}
	}
}

FText AHLNoteItem::GetInteractText_Implementation() const
{
	return FText::FromString(TEXT("Read"));
}
