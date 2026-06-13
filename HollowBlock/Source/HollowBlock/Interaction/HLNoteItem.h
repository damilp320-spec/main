// Copyright Hollow Block. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/HLInteractableInterface.h"
#include "HLNoteItem.generated.h"

class UStaticMeshComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnNoteRead, const FText&, Title, const FText&, Body);

/**
 * A readable note — the game's main storytelling channel. Hollow Block tells its
 * story environmentally: scraps left by residents who are no longer here. On
 * interact it broadcasts its title/body so a UMG reader widget can display it, and
 * raises tension slightly (reading them is unsettling). Marked read after first use.
 */
UCLASS()
class HOLLOWBLOCK_API AHLNoteItem : public AActor, public IHLInteractableInterface
{
	GENERATED_BODY()

public:
	AHLNoteItem();

	// IHLInteractableInterface
	virtual void Interact_Implementation(AActor* Interactor) override;
	virtual FText GetInteractText_Implementation() const override;
	virtual bool CanInteract_Implementation(AActor* Interactor) const override { return true; }

	UFUNCTION(BlueprintPure, Category = "Note")
	bool HasBeenRead() const { return bRead; }

	UPROPERTY(BlueprintAssignable, Category = "Note")
	FOnNoteRead OnNoteRead;

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Note")
	TObjectPtr<UStaticMeshComponent> Mesh;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Note")
	FText Title;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Note", meta = (MultiLine = true))
	FText Body;

	/** Tension added the first time this note is read. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Note", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float TensionOnRead = 0.05f;

private:
	bool bRead = false;
};
