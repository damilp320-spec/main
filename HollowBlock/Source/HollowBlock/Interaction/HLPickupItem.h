// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/HLInteractableInterface.h"
#include "HLPickupItem.generated.h"

class UStaticMeshComponent;

UENUM(BlueprintType)
enum class EHLItemType : uint8
{
	/** Story / quest item identified by ItemTag (keys, fuses). */
	KeyItem,
	/** Recharges the flashlight battery. */
	Battery
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnItemPickedUp, EHLItemType, ItemType, FName, ItemTag);

/**
 * A pickup the player can collect: a key item (tracked by tag so doors can require
 * it) or a battery (which refills the flashlight). On pickup it broadcasts and
 * destroys itself; an inventory Blueprint or the door logic listens for the tag.
 */
UCLASS()
class HOLLOWBLOCK_API AHLPickupItem : public AActor, public IHLInteractableInterface
{
	GENERATED_BODY()

public:
	AHLPickupItem();

	// IHLInteractableInterface
	virtual void Interact_Implementation(AActor* Interactor) override;
	virtual FText GetInteractText_Implementation() const override;
	virtual bool CanInteract_Implementation(AActor* Interactor) const override { return true; }

	UPROPERTY(BlueprintAssignable, Category = "Pickup")
	FOnItemPickedUp OnItemPickedUp;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Pickup")
	TObjectPtr<UStaticMeshComponent> Mesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Pickup")
	EHLItemType ItemType = EHLItemType::KeyItem;

	/** Identifier used by doors / objectives to recognise this key item. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Pickup")
	FName ItemTag = NAME_None;

	/** Prompt shown when focused. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Pickup")
	FText PickupPrompt;

	/** Fraction of flashlight battery restored when ItemType is Battery (0..1). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Pickup", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float BatteryRestoreFraction = 0.5f;
};
